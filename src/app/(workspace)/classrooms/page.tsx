import { redirect } from "next/navigation";

export default function ClassroomsPage() {
  // The former classroom index rendered an imported transcript as one raw,
  // unformatted block. The Coach now owns lesson creation and navigation.
  redirect("/coach");
}
