import { jsx } from "react/jsx-runtime";
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InviteModal } from "../components/admin/InviteModal";
import { UserTable } from "../components/admin/UserTable";
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "self" } } }) }));
vi.mock("../components/ui/Listbox", () => ({ Listbox: ({ children, value, disabled }) => /* @__PURE__ */ jsx("select", { defaultValue: value, disabled, children }) }));
it.each([true, false])("invite admin option follows ownership: %s", (isOwner) => {
  const html = renderToStaticMarkup(/* @__PURE__ */ jsx(InviteModal, { open: true, onClose: () => {
  }, orgId: "org", onInvited: () => {
  }, canInviteAdmin: isOwner }));
  expect(html.includes('value="admin"')).toBe(isOwner);
  expect(html.includes("Only Dreamlabs platform owners can add admins.")).toBe(!isOwner);
  expect(html).toContain('value="contractor" selected');
});
const row = (id, role) => ({
  role,
  created_at: "2026-10-22",
  profiles: { id, email: "test@example.invalid", full_name: "Test", created_at: "2026-10-22" }
});
it("client admin cannot change or remove admin rows, but can manage normal members", () => {
  const html = renderToStaticMarkup(/* @__PURE__ */ jsx(UserTable, { members: [row("other", "admin")], orgId: "org", onChanged: () => {
  }, isOwner: false }));
  expect(html).toContain("<select disabled");
  expect(html).toMatch(/<button[^>]*disabled/);
  expect(html).toContain("Only Dreamlabs platform owners can change or remove admins.");
  const normal = renderToStaticMarkup(/* @__PURE__ */ jsx(UserTable, { members: [row("other", "contractor")], orgId: "org", onChanged: () => {
  }, isOwner: false }));
  expect(normal).not.toContain('value="admin"');
  expect(normal).not.toContain('disabled=""');
});
it("owner controls retain admin options and self protection", () => {
  const html = renderToStaticMarkup(/* @__PURE__ */ jsx(UserTable, { members: [row("self", "admin")], orgId: "org", onChanged: () => {
  }, isOwner: true }));
  expect(html).toContain('value="admin"');
  expect(html).toContain("<select disabled");
  expect(html).toMatch(/<button[^>]*disabled/);
});
