import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router';
import type {LucideIcon} from 'lucide-react';
import type {KeyProvider} from '../../../supabase/functions/_shared/keyHealthRules';
import {problemKey,type ApiKeyHealthRow} from '../../lib/keyHealthView';
import {Collapsible} from '../ui/Collapsible';
import {KeyHealthFlag} from './KeyHealthFlag';

/** Flags and hash targets open once; users can still fold the section while the same problem continues. */
export function KeyHealthSection({provider,title,icon,summary,row,platformOwner=false,children}:{provider:KeyProvider;title:string;icon?:LucideIcon;summary?:ReactNode;row?:ApiKeyHealthRow;platformOwner?:boolean;children:ReactNode}) {
  const {hash}=useLocation();const targeted=hash===`#${provider}`;
  const [open,setOpen]=useState(!!row||targeted);const root=useRef<HTMLDivElement>(null);
  const problem=row?problemKey(row):null;
  useEffect(()=>{if(problem||targeted)setOpen(true);if(targeted)root.current?.scrollIntoView?.({block:'start'});},[problem,targeted,hash]);
  return <div ref={root} id={provider} className="min-w-0 scroll-mt-24"><Collapsible title={title} icon={icon} open={open} onOpenChange={setOpen}
    summary={row?<KeyHealthFlag row={row} summary />:summary}>
    <div className="flex min-w-0 flex-col gap-3">{row&&<KeyHealthFlag row={row} platformOwner={platformOwner}/>} {children}</div>
  </Collapsible></div>;
}
