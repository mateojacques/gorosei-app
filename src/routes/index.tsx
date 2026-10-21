import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="p-4">
      <h1>Gorosei</h1>
    </main>
  );
}
