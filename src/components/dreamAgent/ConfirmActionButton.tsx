import {useEffect,useRef,type ComponentProps} from 'react';
import type {AgentConfirmHandle} from '../../lib/dreamAgentBulk';
import {Button} from '../ui/Button';
/** Register the current row's own confirm action; edits never leave bulk using an old draft. */
export function ConfirmActionButton({onReady,problem,onClick,disabled,...props}:Omit<ComponentProps<typeof Button>,'onClick'>&{
 onReady?:(handle:AgentConfirmHandle|null)=>void;problem?:string|null;onClick:()=>void;
}) {
 const current=useRef(onClick);current.current=onClick;
 const reason=problem??(disabled?'Complete the required fields in this row.':null);
 useEffect(()=>{onReady?.({confirm:()=>current.current(),problem:reason});return()=>onReady?.(null);},[onReady,reason]);
 return <Button {...props} disabled={disabled} onClick={onClick} />;
}
