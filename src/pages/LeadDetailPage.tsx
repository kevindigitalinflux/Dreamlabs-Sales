import { useParams } from 'react-router';

/** Full lead record — placeholder until Task 13. */
export function LeadDetailPage() {
  const { id } = useParams();
  return <h1 className="text-[28px] font-extrabold">Lead {id}</h1>;
}
