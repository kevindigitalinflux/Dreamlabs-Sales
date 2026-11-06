export function EnrichmentMode({replaceExisting,setReplaceExisting,busy}:{replaceExisting:boolean;setReplaceExisting:(replace:boolean)=>void;busy:boolean}) {
 return (<fieldset disabled={busy} className="flex flex-col gap-1 rounded-lg bg-surface/60 p-3 text-sm">
            <legend className="px-1 text-xs font-semibold text-muted">If a lead already has a value for a field</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="enrich-mode" checked={!replaceExisting} onChange={() => setReplaceExisting(false)} className="mt-0.5 h-4 w-4 accent-violet-500" />
              <span>
                <span className="font-semibold">Add as additional details</span>
                <span className="block text-xs text-muted">Keep what's there and save the new value under the lead's additional emails, phones, websites or owners. Blank fields are filled in.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="enrich-mode" checked={replaceExisting} onChange={() => setReplaceExisting(true)} className="mt-0.5 h-4 w-4 accent-violet-500" />
              <span>
                <span className="font-semibold">Replace existing details</span>
                <span className="block text-xs text-muted">Overwrite what's there with the found value.</span>
              </span>
            </label>
          </fieldset>);
}
