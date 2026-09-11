import { NoiseBackdrop } from './NoiseBackdrop';
import { Glyph } from './Glyph';
import {
  LoudButton,
  LoudCard,
  Mark,
  Step,
  Sticker,
  Ticker,
} from '../../design/Primitives';

/**
 * Landing page.
 *
 * HEADLINE SELECTION — several were written and one picked, per the brief. The
 * bar was "funny AND explains what it does in one read", which killed most of
 * them:
 *
 *   "Military-grade cowardice."                          funny, explains nothing
 *   "Nobody has ever wanted to be seen less."            funny, explains nothing
 *   "It's just a chair. It's also a tactical decision."  cute, too vague
 *   "We built a radar so you never get asked a question
 *    again."                                             good, but hides the how
 *   "Sit where the teacher isn't looking. We did the
 *    maths."                                             clear, decent wink
 *   "Point a webcam at your class. We'll tell you where
 *    to hide."                                        ← picked
 *
 * The winner is the only one carrying the mechanism (a webcam, pointed at a real
 * room) and the payoff (where to hide) in one sentence, and the flat delivery of
 * "we'll tell you where to hide" is doing the comedy without needing a punchline.
 * The rejected one-liners survive as stickers and the ticker, which is where a
 * joke with no explanatory duty belongs.
 */

const TICKER_ITEMS = [
  'SCANNING FOR EYE CONTACT',
  'MEAT SHIELD ONLINE',
  'ACADEMIC VALUE: 0%',
  'DO NOT MAKE EYE CONTACT',
  'CHAIR ACQUIRED',
  'NOBODY HAS EVER WANTED TO BE SEEN LESS',
  'MILITARY-GRADE COWARDICE',
];

interface Props {
  onOpenSurveillance: () => void;
  onOpenMusicalChairs: () => void;
}

export function LandingScreen({ onOpenSurveillance, onOpenMusicalChairs }: Props) {
  return (
    <>
      <NoiseBackdrop />

      <div className="hns-page">
        <div className="hns-wrap">
          <header className="hns-hero">
            <div className="hns-hero__kicker">
              <Sticker tone="yellow" rotate={-3}>
                Military-grade cowardice
              </Sticker>
              <Sticker tone="coral" rotate={2}>
                Zero academic value
              </Sticker>
              <Sticker tone="green" rotate={-1} ghost>
                Runs in your browser
              </Sticker>
            </div>

            <h1 className="hns-heading hns-heading--xl">
              Point a webcam at your class.{' '}
              <Mark tone="amber">We&apos;ll tell you where to hide.</Mark>
            </h1>

            <p className="hns-hero__lede">
              Hide n Seat finds every chair in the room, works out how likely the
              teacher is to look at each one, and puts a big number on it. Low
              number means you&apos;re safe. High number means run. There is a second
              screen that plays music and picks a chair for you, because we got
              carried away.
            </p>

            <div className="hns-hero__cta">
              <LoudButton tone="amber" solid size="lg" onClick={onOpenSurveillance}>
                <Glyph name="radar" size={22} />
                Open the radar
              </LoudButton>
              <LoudButton tone="coral" size="lg" onClick={onOpenMusicalChairs}>
                <Glyph name="hat" size={22} />
                Let it pick for me
              </LoudButton>
            </div>

            <p className="hns-hero__note">
              Needs a webcam and about four seconds of your dignity.
            </p>

            <div className="hns-stats">
              <div className="hns-stat hns-amber">
                <div className="hns-stat__n">0–100</div>
                <div className="hns-stat__k">Exposure per chair</div>
              </div>
              <div className="hns-stat hns-coral">
                <div className="hns-stat__n">1.5 Hz</div>
                <div className="hns-stat__k">Scan rate</div>
              </div>
              <div className="hns-stat hns-yellow">
                <div className="hns-stat__n">10 s</div>
                <div className="hns-stat__k">Music round</div>
              </div>
              <div className="hns-stat hns-green">
                <div className="hns-stat__n">0%</div>
                <div className="hns-stat__k">Learning delivered</div>
              </div>
            </div>
          </header>
        </div>

        <Ticker items={TICKER_ITEMS} tone="amber" />

        <div className="hns-wrap">
          <section className="hns-section">
            <div className="hns-section__head">
              <h2 className="hns-heading hns-heading--lg">
                Three things it actually does
              </h2>
              <Sticker tone="violet" rotate={3} ghost>
                All real, somehow
              </Sticker>
            </div>

            <div className="hns-grid-3">
              <LoudCard
                tone="amber"
                title="Every chair gets a number"
                badge="Live"
                badgeRotate={5}
                icon={
                  <span className="hns-card__icon">
                    <Glyph name="chair" size={26} />
                  </span>
                }
              >
                An object detector finds the chairs, then geometry does the rest —
                how far off the teacher&apos;s eyeline you are, how far away, whether
                anything is in the way. The number updates while they pace.
              </LoudCard>

              <LoudCard
                tone="green"
                title="The Meat Shield"
                badge="Peer-reviewed*"
                badgeRotate={-4}
                icon={
                  <span className="hns-card__icon">
                    <Glyph name="eye" size={26} />
                  </span>
                }
              >
                Tall person in front of you? That is cover, and you get credit for
                it. We trace the teacher&apos;s line of sight through every body in the
                room and dock the score of anyone who is genuinely hidden.
              </LoudCard>

              <LoudCard
                tone="coral"
                title="Musical chairs, but surveillance"
                badge="Loud"
                badgeRotate={4}
                icon={
                  <span className="hns-card__icon">
                    <Glyph name="blip" size={26} />
                  </span>
                }
              >
                Someone walks in, the music starts, an eye hops around the room for
                ten seconds. Music stops, one chair lights up and says{' '}
                <strong>vann iri</strong>. That is the whole feature. It is the best
                one.
              </LoudCard>
            </div>
          </section>

          <section className="hns-section">
            <div className="hns-section__head">
              <h2 className="hns-heading hns-heading--lg">How it works</h2>
              <Sticker tone="amber" rotate={-2}>
                Four steps, one regret
              </Sticker>
            </div>

            <div className="hns-grid-2">
              <Step n={1} tone="amber" title="Point the webcam at the room" rotate={-3}>
                Front of the room, looking back over the seats. It needs to see
                chairs and people, not the ceiling.
              </Step>
              <Step n={2} tone="yellow" title="Click where the teacher is" rotate={2}>
                One click sets the apex of the vision cone. Move them any time —
                they pace, and the numbers follow.
              </Step>
              <Step n={3} tone="green" title="Read the numbers" rotate={-2}>
                Green is concealed, amber is exposed-ish, red means they are
                basically already looking at you.
              </Step>
              <Step n={4} tone="coral" title="Ignore the numbers entirely" rotate={3}>
                Sit next to your friends anyway. The maths was never going to win
                that argument.
              </Step>
            </div>
          </section>
        </div>

        <footer className="hns-footer">
          <div className="hns-wrap">
            <h2 className="hns-heading hns-heading--lg">
              Go and <Mark tone="coral">hide</Mark>
            </h2>

            <div className="hns-footer__cta">
              <LoudButton tone="amber" solid onClick={onOpenSurveillance}>
                <Glyph name="radar" size={18} />
                Open the radar
              </LoudButton>
              <LoudButton tone="coral" onClick={onOpenMusicalChairs}>
                <Glyph name="hat" size={18} />
                Let it pick for me
              </LoudButton>
            </div>

            <p className="hns-fineprint">
              * Not peer-reviewed. Hide n Seat runs entirely in your browser and no
              video leaves your machine — mostly because we never built anywhere to
              send it. Chair detection is genuinely the hard part and it will miss
              some. Any resemblance to real defence software is a joke that got out
              of hand.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
