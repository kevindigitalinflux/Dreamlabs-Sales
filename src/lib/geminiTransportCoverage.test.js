import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it.each(['parse-icp','org-api-settings'])('leaves the separate %s Gemini transport outside Deep find admission',name=>{
 const source=readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
 expect(source).not.toContain('admitGemini');
});

it('keys SQL admission by organisation and minute, with matching conflict target and service-only grants',()=>{
 const sql=readFileSync('supabase/migrations/078_deep_find_parallel.sql','utf8');
 expect(sql).toMatch(/PRIMARY KEY\s*\(org_id,\s*minute\)/i);
 expect(sql).toContain('gemini_admit(p_org uuid)');expect(sql).toMatch(/ON CONFLICT\s*\(org_id,\s*minute\)/i);
 expect(sql).toContain('FUNCTION public.gemini_admit(uuid) FROM PUBLIC,anon,authenticated');
 expect(sql).toContain("minute < now()-interval '1 day'");
});
