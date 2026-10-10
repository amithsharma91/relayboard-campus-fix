import seedData from "../../../lib/seed.json";
import DetailClient from "./detail-client";

// Server wrapper: keeps generateStaticParams (10 seeds) + dynamicParams and
// renders the client detail. All interactive review UI lives in
// detail-client.tsx (the one shared-file exception for this route).

export function generateStaticParams() {
  return (seedData.items as Array<{ id: string }>).map((item) => ({
    id: item.id,
  }));
}

export const dynamicParams = true;

export default function RequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <DetailClient id={params.id} />;
}
