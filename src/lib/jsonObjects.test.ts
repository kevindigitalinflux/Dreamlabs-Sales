import {expect,it} from 'vitest';
import {jsonObjects} from '../../supabase/functions/_shared/jsonObjects';
it.each([
 '{"name":"Ann Roe"}\n{"name":"Gary Ramsay"}',
 '{\n "name": "Ann Roe"\n}\n{\n "name": "Gary Ramsay"\n}',
 '```json\n[{"name":"Ann Roe"},{"name":"Gary Ramsay"}]\n```',
 'People found:\n{"name":"Ann Roe"}\nOther prose {invalid}\n{"name":"Gary Ramsay"}\nEnd.',
])('reads top-level objects without treating prose as JSON: %s',text=>expect(jsonObjects(text).map(x=>x.value)).toEqual([{name:'Ann Roe'},{name:'Gary Ramsay'}]));
it('keeps braces and escaped quotes inside strings and does not emit nested objects',()=>{
 const value={name:'Ann { Roe } "quoted"',nested:{x:1}};
 expect(jsonObjects(JSON.stringify(value)).map(x=>x.value)).toEqual([value]);
});
