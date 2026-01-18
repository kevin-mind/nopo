import { Link } from "react-router";

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <nav className="max-w-4xl mx-auto flex items-center">
        <Link to="/" aria-label="Go to homepage" className="text-xl font-bold">
          Nopo
        </Link>
      </nav>
    </header>
  );
}
