export function Notices({ error, done }: { error?: string; done?: string }) {
  return (
    <>
      {error && <div className="notice error" role="alert">{error}</div>}
      {done && <div className="notice success" role="status">{done}</div>}
    </>
  );
}
