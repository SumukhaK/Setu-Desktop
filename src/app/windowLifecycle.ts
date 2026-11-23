export interface WindowPort {
  hide(): Promise<void>;
  quit(): Promise<void>;
  onQuitRequested(cb: () => void): Promise<() => void>;
}
