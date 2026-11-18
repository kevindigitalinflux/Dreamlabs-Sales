import {useState} from 'react';
import {Button} from '../ui/Button';

/** Testing is an explicit action; errors do not disappear behind an unhandled promise. */
export function KeyHealthTestButton({test}:{test:()=>Promise<string|null>}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  async function run(){setBusy(true);setMessage(null);try{setMessage(await test()??'Key test passed.');}catch{console.error('api_key_test_failed');setMessage('Could not test this key. Try again.');}finally{setBusy(false);}}
  return <div className="flex flex-col items-start gap-2"><Button variant="secondary" loading={busy} disabled={busy} onClick={()=>{void run();}}>Test current key</Button>{message&&<p role="status" className="text-sm">{message}</p>}</div>;
}
