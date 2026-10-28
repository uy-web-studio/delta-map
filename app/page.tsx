import MapApp from "@/components/MapApp";
import { loadData } from "@/lib/data";

export default function Page() {
  return <MapApp data={loadData()} />;
}
