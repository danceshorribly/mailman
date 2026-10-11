import HeaderPage from "@/components/HeaderPage";
import SegmentEditor from "@/components/SegmentEditor";
import { connectDb } from "@/lib/db";
import { serialize } from "@/lib/serialize";
import Newsletter from "@/models/Newsletter";
import Segment from "@/models/Segment";
export const metadata = { title: "Segments" };
export default async function SegmentsPage() {
	await connectDb();
	const [newsletters, segments] = await Promise.all([
		Newsletter.find().select("name").lean(),
		Segment.find().sort({ name: 1 }).lean(),
	]);
	return (
		<>
			<HeaderPage title="Customer segments" />
			<SegmentEditor
				newsletters={serialize(newsletters)}
				segments={serialize(segments)}
			/>
		</>
	);
}
