import type { PairPort } from "./pairPort";

export function PairDialog({ port, onClose }: { port: PairPort; onClose: () => void }) {
  void port;
  void onClose;
  return (
    <div role="dialog" aria-labelledby="pair-title">
      <h2 id="pair-title">Pair new device</h2>
    </div>
  );
}
