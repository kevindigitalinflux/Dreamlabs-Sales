import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { decideAdminAction } from "../../supabase/functions/_shared/adminPolicy";
function setup(options = {}) {
  const writes = [];
  const reads = [];
  const rpc = vi.fn(async () => ({ data: options.owner ?? false, error: options.rpcError ? { message: "private detail" } : null }));
  const service = {
    rpc,
    auth: { admin: { inviteUserByEmail: vi.fn(async () => {
      writes.push("invite");
      return { data: { user: { id: "invited" } }, error: null };
    }) } },
    from(table) {
      const filters = {};
      let counting = false;
      let mutation = false;
      const query = {
        select(_fields, opts) {
          counting = opts?.head === true;
          return query;
        },
        eq(key, value) {
          filters[key] = value;
          return query;
        },
        order() {
          return query;
        },
        insert() {
          mutation = true;
          writes.push(`${table}:insert`);
          return query;
        },
        update() {
          mutation = true;
          writes.push(`${table}:update`);
          return query;
        },
        delete() {
          mutation = true;
          writes.push(`${table}:delete`);
          return query;
        },
        single() {
          return query;
        },
        maybeSingle() {
          return query;
        },
        then(resolve) {
          reads.push({ table, filters });
          const error = options.queryError && table === "org_members" ? { message: "private detail" } : null;
          let data = null;
          if (!mutation && table === "profiles") data = { platform_role: options.owner === true ? "platform_admin" : "user" };
          if (table === "org_members" && filters.user_id) {
            const role = filters.user_id === "caller" ? options.callerRole : options.targetRole;
            data = role ? { role } : null;
          }
          if (table === "org_members" && !filters.org_id) data = [{ role: "admin", organizations: { id: "own", name: "Own org" } }];
          if (table === "organizations") data = mutation ? { id: "new", name: "New" } : [{ id: "own", name: "Own org" }, { id: "other", name: "Other" }];
          return Promise.resolve(resolve({ data, error, count: counting ? options.count ?? 2 : null }));
        }
      };
      return query;
    }
  };
  let handler;
  const deno = { env: { get: () => void 0 }, serve: (fn) => {
    handler = fn;
  } };
  const source = readFileSync("supabase/functions/admin-users/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  const js = transformSync(source, { loader: "ts", target: "es2022" }).code;
  let clients = 0;
  const createClient = () => ++clients % 2 === 1 ? { auth: { getUser: async () => ({ data: { user: { id: "caller" } } }) } } : service;
  new Function("Deno", "createClient", "decideAdminAction", js)(deno, createClient, decideAdminAction);
  const request = (body) => handler(new Request("http://local", { method: "POST", body: JSON.stringify(body) }));
  return { request, writes, reads, rpc };
}
describe("admin-users handler authorization", () => {
  it.each([
    { action: "invite", org_role: "admin", email: "test@example.invalid", redirect_to: "http://localhost:5173/welcome" },
    { action: "set_org_role", role: "admin" },
    { action: "remove_member" }
  ])("client admin cannot manage admins: $action", async (body) => {
    const h = setup({ callerRole: "admin", targetRole: "admin" });
    const res = await h.request({ org_id: "own", user_id: "target", ...body });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only platform owners can add or change admins" });
    expect(h.writes).toEqual([]);
  });
  it.each(["create_org", "list_orgs", "set_org_role", "remove_member"])("RPC error fails closed: %s", async (action) => {
    const h = setup({ rpcError: true, callerRole: "admin", targetRole: "admin" });
    const res = await h.request({ action, name: "New", org_id: "own", user_id: "target", role: "contractor" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not check permissions" });
    expect(h.writes).toEqual([]);
  });
  it.each(["set_org_role", "remove_member"])("last admin cannot be changed: %s", async (action) => {
    const h = setup({ owner: true, targetRole: "admin", count: 1 });
    const res = await h.request({ action, org_id: "other", user_id: "target", role: "contractor" });
    expect(res.status).toBe(400);
    expect(h.writes).toEqual([]);
  });
  it("membership read error refuses writes with fixed error", async () => {
    const h = setup({ owner: true, queryError: true });
    const res = await h.request({ action: "set_org_role", org_id: "other", user_id: "target", role: "contractor" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not check permissions" });
    expect(h.writes).toEqual([]);
  });
  it("owner list includes caller roles and uses the ownership RPC", async () => {
    const h = setup({ owner: true });
    const res = await h.request({ action: "list_orgs" });
    expect(await res.json()).toEqual({ orgs: [{ id: "own", name: "Own org", role: "admin" }, { id: "other", name: "Other", role: null }] });
    expect(h.rpc).toHaveBeenCalledWith("is_platform_owner", { p_user: "caller" });
  });
  it("uses target-org membership for cross-org denial", async () => {
    const h = setup();
    expect((await h.request({ action: "list_org_members", org_id: "other" })).status).toBe(403);
    expect(h.reads).toContainEqual({ table: "org_members", filters: { org_id: "other", user_id: "caller" } });
    expect(h.writes).toEqual([]);
  });
  it("removal still unassigns leads before deleting membership", async () => {
    const h = setup({ callerRole: "admin", targetRole: "contractor" });
    expect((await h.request({ action: "remove_member", org_id: "own", user_id: "target" })).status).toBe(200);
    expect(h.writes).toEqual(["leads:update", "org_members:delete"]);
  });
});
