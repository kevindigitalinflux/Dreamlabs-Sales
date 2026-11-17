import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it.each(['parse-icp','org-api-settings'])('guards the separate %s Gemini transport before fetch',name=>{
 const source=readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
 expect(source.indexOf('await admitGemini(')).toBeGreaterThan(0);
 expect(source.indexOf('await admitGemini(')).toBeLessThan(source.indexOf('await fetch('));
});
