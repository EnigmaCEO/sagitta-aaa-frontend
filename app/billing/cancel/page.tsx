import Link from "next/link";

export default async function BillingCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  return (
    <main style={{ padding: 24 }}>
      <h1>Billing Canceled</h1>
      <p>Checkout session: {session_id ?? "(missing)"}</p>
      <p>Your checkout was canceled. You can return to the app or try again.</p>
      <p style={{ marginTop: 12 }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          Return to home
        </Link>
      </p>
    </main>
  );
}
