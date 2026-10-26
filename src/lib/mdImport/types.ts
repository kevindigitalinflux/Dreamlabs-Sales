import type { IcpInput } from '../../hooks/useIcps';
import type { EmailLink } from '../emailAttachments';

export interface ImportedTemplate { name: string; subject: string; body: string; icp: string | null; category: string | null; links: EmailLink[] }
export interface Issue { line: number; message: string }
export type ParsedFile =
  | { type: 'company-context'; data: string; errors: Issue[]; warnings: Issue[] }
  | { type: 'icp-profiles'; data: IcpInput[]; errors: Issue[]; warnings: Issue[] }
  | { type: 'email-templates'; data: ImportedTemplate[]; errors: Issue[]; warnings: Issue[] }
  | { type: null; data: null; errors: Issue[]; warnings: Issue[] };
export interface NamedProfile { id: string; name: string }
export interface NamedTemplate { id: string; name: string; icp_id: string | null }
export interface ImportFile { id: string; filename: string; parsed: ParsedFile; selected: boolean[]; replace: boolean; append: boolean }
