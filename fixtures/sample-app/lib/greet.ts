export function greet(name: string): string {
  const safe = name.trim();
  if (!safe) return "Hello, stranger.";
  return `Hello, ${safe}.`;
}

export function farewell(name: string): string {
  const safe = name.trim();
  if (!safe) return "Goodbye.";
  return `Goodbye, ${safe}.`;
}
