import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const sql=()=>readFileSync('supabase/migrations/078_deep_find_parallel.sql','utf8');
it('claims with a database admission-row lock and running-count priority before run age',()=>{
 const text=sql();expect(text).toMatch(/deep_find_claim\(max_leads/);expect(text).toMatch(/PERFORM[\s\S]*deep_find_runtime_config[\s\S]*FOR UPDATE/);
 expect(text).toMatch(/ORDER BY[\s\S]*count\(\*\)[\s\S]*r.started_at[\s\S]*q.updated_at[\s\S]*q.id/);
 expect(text).toContain('FOR UPDATE OF q SKIP LOCKED');expect(text).toContain('least(10');
});
