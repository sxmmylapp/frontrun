import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support — FrontRun',
  description: 'Get help with FrontRun prediction markets app',
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">FrontRun Support</h1>
        <p className="text-neutral-400 text-lg">
          Need help with FrontRun? We&apos;re here to assist you.
        </p>

        <div className="space-y-6 text-left bg-neutral-900 rounded-xl p-6 border border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold mb-2">Contact Us</h2>
            <p className="text-neutral-400">
              For questions, feedback, or issues, email us at{' '}
              <a
                href="mailto:support@frontrun.bet"
                className="text-emerald-400 hover:text-emerald-300 underline"
              >
                support@frontrun.bet
              </a>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">FAQs</h2>
            <div className="space-y-3 text-neutral-400">
              <div>
                <p className="font-medium text-neutral-200">What are tokens?</p>
                <p>
                  Tokens are virtual currency used within FrontRun. They have no
                  real-world monetary value and cannot be withdrawn or exchanged
                  for real money.
                </p>
              </div>
              <div>
                <p className="font-medium text-neutral-200">How do I place a trade?</p>
                <p>
                  Browse markets, select an outcome you believe in, enter your
                  token amount, and confirm your trade. Prices update in
                  real-time.
                </p>
              </div>
              <div>
                <p className="font-medium text-neutral-200">How do I get more tokens?</p>
                <p>
                  You receive free tokens when you sign up. Earn more by making
                  correct predictions. Top performers on the leaderboard receive
                  bonus tokens during prize periods.
                </p>
              </div>
              <div>
                <p className="font-medium text-neutral-200">Is this gambling?</p>
                <p>
                  No. FrontRun is an educational and entertainment platform using
                  virtual tokens only. No real money is involved at any point.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Privacy</h2>
            <p className="text-neutral-400">
              View our{' '}
              <a
                href="/privacy"
                className="text-emerald-400 hover:text-emerald-300 underline"
              >
                Privacy Policy
              </a>
            </p>
          </div>
        </div>

        <p className="text-neutral-600 text-sm">
          &copy; {new Date().getFullYear()} Lapp&apos;s Online Dynamics. All rights reserved.
        </p>
      </div>
    </div>
  );
}
