// deno-lint-ignore no-explicit-any
type Query=any;
/** Ordered pages prevent the API's default row limit from silently changing safety rates. */
export async function readComplete(query:()=>Query):Promise<{data:Record<string,any>[];count:number;error:null}> {
 const rows:Record<string,any>[]=[];let expected:number|undefined;
 for(let offset=0;offset<100000;offset+=1000){
  const page=await query().order('id').range(offset,offset+999);
  if(page.error||!Array.isArray(page.data)||typeof page.count!=='number'||(expected!==undefined&&page.count!==expected))throw Error('Safety evidence could not be read completely.');
  expected=page.count;rows.push(...page.data);
  if(rows.length===expected)return {data:rows,count:expected,error:null};
  if(!page.data.length||rows.length>page.count)break;
 }
 throw Error('Safety evidence exceeded the complete-read limit.');
}
