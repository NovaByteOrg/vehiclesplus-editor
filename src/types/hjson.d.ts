declare module "hjson" {
  const Hjson: {
    parse(text: string, options?: unknown): unknown;
    stringify(value: unknown, options?: unknown): string;
  };
  export default Hjson;
}
