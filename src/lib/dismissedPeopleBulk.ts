import type {SupabaseClient} from '@supabase/supabase-js';
import {restoreDismissedContact,type DismissedContact} from './restoreDismissed';
/** Restore selected and single-person controls share the same RLS and compare-and-set path. */
export async function restoreSelectedPerson(client:Pick<SupabaseClient,'from'>,person:DismissedContact) {
 return (await restoreDismissedContact(client,person.id,person.name)).error;
}
