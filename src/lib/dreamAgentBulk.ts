export interface AgentConfirmHandle {confirm:()=>void;problem:string|null}
/** Uses the same edited resolution and validation as the row's Confirm button. No database writes here. */
export async function confirmAgentRow(handle:AgentConfirmHandle|undefined):Promise<string|null> {
 if(!handle)return 'Finish reviewing this row before confirming it.';
 if(handle.problem)return handle.problem;
 handle.confirm();return null;
}
