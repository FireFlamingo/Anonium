import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";

export default function NotFound() {
  return (
    <div className="wrap-narrow !px-0">
      <PageHead eyebrow="404" title="Page not found" lede="That address doesn't match any page on this platform." />
      <Link to="/" className="btn btn-secondary mt-8">Back to overview</Link>
    </div>
  );
}
