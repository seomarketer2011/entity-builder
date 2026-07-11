import { signIn, signUp } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="card" style={{ maxWidth: "24rem", margin: "3rem auto" }}>
      <h1>Sign in</h1>
      {params.error ? <p className="error">{params.error}</p> : null}
      {params.notice ? <p className="muted">{params.notice}</p> : null}
      <form>
        <p>
          <input name="email" type="email" placeholder="email" required style={{ width: "100%" }} />
        </p>
        <p>
          <input
            name="password"
            type="password"
            placeholder="password"
            required
            minLength={8}
            style={{ width: "100%" }}
          />
        </p>
        <p style={{ display: "flex", gap: "0.5rem" }}>
          <button formAction={signIn}>Sign in</button>
          <button formAction={signUp} className="secondary">
            Create account
          </button>
        </p>
      </form>
    </div>
  );
}
