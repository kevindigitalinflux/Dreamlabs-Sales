import { useState } from 'react';
import { toggleRow, selectRows } from '../lib/rowSelection';
/** Keep selection scoped to the current actionable rows. */
export function useRowSelection(ids: string[],initialSelected:string[]=[]) {
 const [keys, setKeys] = useState<Set<string>>(()=>new Set(initialSelected));
 const selected = new Set(ids.filter(id => keys.has(id)));
 return { selected, toggle: (id:string) => setKeys(previous => toggleRow(new Set(ids.filter(key => previous.has(key))), id)),
 all: () => setKeys(selectRows(selected, ids)), clear: () => setKeys(new Set()),
 remove: (id:string) => setKeys(previous => new Set([...previous].filter(key => key !== id))) };
}
