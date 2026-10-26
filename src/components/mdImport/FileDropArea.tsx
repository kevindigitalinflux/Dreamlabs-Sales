import { useRef } from 'react';
import { Button } from '../ui/Button';

/** Keyboard-accessible file chooser with the same path for drag and drop. */
export function FileDropArea({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="rounded-xl border border-dashed border-line p-4 text-sm"
    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!disabled) onFiles(Array.from(e.dataTransfer.files)); }}>
    <p className="mb-3">Drop .md files here. Up to 200 KB each.</p>
    <input ref={input} className="hidden" type="file" multiple accept=".md,text/markdown" aria-label="Setup Markdown files" disabled={disabled}
      onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    <Button variant="secondary" disabled={disabled} onClick={() => input.current?.click()}>Choose files</Button>
  </div>;
}
