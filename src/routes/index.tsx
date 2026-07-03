import { createFileRoute } from "@tanstack/react-router";
import { ShrinkItApp } from "@/components/shrinkit/ShrinkItApp";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <ShrinkItApp />;
}
