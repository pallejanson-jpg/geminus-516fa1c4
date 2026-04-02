import { Spinner } from './spinner';

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <Spinner size="xl" label="Loading…" />
    </div>
  );
}
