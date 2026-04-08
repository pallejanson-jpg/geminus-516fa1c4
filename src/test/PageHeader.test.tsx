import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PageHeader from "@/components/common/PageHeader";

describe("PageHeader", () => {
  it("renders the title as an h1", () => {
    render(<PageHeader title="Dashboard" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Dashboard");
  });

  it("renders a description when provided", () => {
    render(<PageHeader title="Test" description="Some description" />);
    expect(screen.getByText("Some description")).toBeInTheDocument();
  });

  it("does not render description when omitted", () => {
    const { container } = render(<PageHeader title="Test" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders actions slot", () => {
    render(<PageHeader title="Test" actions={<button>Click me</button>} />);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });
});
