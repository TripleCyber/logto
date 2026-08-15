/**
 * LOGTO PATCH(te-factor-choice): copy for the TripleEnable QR and push factors.
 *
 * These live in `phrases-experience`, next to every other string the experience shows, and not
 * hard-coded in the components. Two reasons, and both are requirements rather than taste:
 * the tenant can rewrite any of them from the console through custom phrases, and the screens
 * keep working in every language the rest of the flow supports.
 *
 * Wording rules applied here, because a sign-in screen is read by someone who is stuck:
 * no jargon (no "IP", no "risk", no "score"), no blame, and every failure ends with something
 * to do next.
 *
 * Upstream: (new file)
 */
const te = {
  qr: {
    title: 'Scan to sign in',
    description: 'Open your TripleEnable wallet and scan this code.',
    /** Text alternative to the code itself, read out by screen readers. */
    alt: 'Sign-in code for your TripleEnable wallet. It refreshes on its own every few seconds.',
    no_camera: "Can't scan? Open your wallet and use the sign-in option there.",
    pair_code_label: 'Check this number',
    pair_code_hint:
      'Your wallet will show the same four digits. If they differ, stop and start again.',
    refresh_in: 'The code refreshes in {{seconds}}s',
    /**
     * LOGTO PATCH(te-signin-split): heading and note for the QR column of the sign-in card.
     * It is the first thing on the screen, so it names the thing and says what it costs —
     * nothing to type — instead of explaining the protocol.
     */
    aside_title: 'TripleEnable wallet',
    aside_note: 'Scan the code. No password, nothing to type.',
  },
  push: {
    title: 'Approve on your phone',
    /**
     * LOGTO PATCH(te-push-destino): it no longer claims a send that has not happened.
     *
     * It used to say «We sent a request to your device» — and at the moment this screen appears,
     * nothing has been sent: the server resolves the identifier in a background worker so that
     * the response latency cannot say whether the account exists (PU-4). It also said «your
     * device», singular and without saying which, which helps nobody. Where the request went is
     * now a line of its own (`sending` / `sent_*`), said when it is true; this one says what to
     * do, which is true from the first second.
     */
    description: 'Approve the request in your TripleEnable wallet to continue.',
    match_label: 'Type these digits on your phone',
    match_hint: 'They are only shown here, never in the notification.',
    another_device: 'Use another device',
    devices_title: 'Choose a device',
    devices_description: 'Pick where to send the request.',
    device_phone: 'Phone',
    device_tablet: 'Tablet',
    device_desktop: 'Computer',
    last_seen_today: 'used today',
    last_seen_this_week: 'used this week',
    last_seen_older: 'used a while ago',
    device_option: '{{kind}} · {{lastSeen}}',
    send_here: 'Send here',
    /**
     * LOGTO PATCH(te-push-destino): where the request actually went.
     *
     * The screen used to say «your device» — singular, and without saying which. These say it,
     * with the same masked label the device list already shows: a coarse category and a time
     * bucket. Never the name the person gave the device, never the model. That can be shown
     * **after** approval; before it, whoever is looking at this screen is only whoever typed an
     * identifier.
     *
     * `sending` is not a placeholder: for a few seconds it is the truth. The server resolves the
     * identifier in a background worker, outside the request cycle, so that the response latency
     * cannot say whether the account exists (PU-4) — when this screen appears, nothing has been
     * sent yet.
     */
    sending: 'Sending the request…',
    sent_phone: 'Sent to your phone · {{lastSeen}}',
    sent_tablet: 'Sent to your tablet · {{lastSeen}}',
    sent_desktop: 'Sent to your computer · {{lastSeen}}',
    /**
     * The fan-out of PU-11: the request goes to every eligible device. It says how many and
     * nothing else — with the request going to the whole fleet, «phone» would describe one device
     * out of a list, and that list is what PU-12 does not hand over.
     *
     * The placeholder is `total` and not `count` on purpose: `count` is the reserved name that
     * turns on i18next's plural machinery, and this string is only ever used with two or more.
     */
    sent_many: 'Sent to your {{total}} devices',
  },
  method: {
    qr_title: 'Scan a code',
    qr_description: 'Sign in with your TripleEnable wallet by scanning a code.',
    push_title: 'Approve on your phone',
    push_description: 'Get a request on your device and approve it there.',
  },
  status: {
    waiting: 'Waiting for your wallet…',
    scanned: 'Code read. Finish on your phone.',
    approving: 'Almost there…',
    rejected: 'The request was turned down. You can try again.',
    expired: 'This took too long. Start again when you are ready.',
    failed: 'Sign-in was not confirmed. Try another method.',
    offline: 'No connection. Trying again…',
    /**
     * LOGTO PATCH(te-signin-split): what a dead channel says when **nobody has scanned yet**.
     *
     * `failed` above says the sign-in was not confirmed, which is a statement about an attempt
     * that happened. Before the live channel reports a scan there is no attempt, so saying that
     * is both wrong and alarming: the person is looking at a code they have not touched. This
     * one states the only fact available — the code is not usable — and ends with the only
     * useful action.
     */
    unavailable: 'This code is not ready. Try again.',
    /**
     * LOGTO PATCH(te-canal-revive): the sign-in itself expired, not just the code.
     *
     * Logto's OIDC interaction lives one hour. Once it is gone, every experience API call answers
     * `404 session.not_found` — including the one that reopens the channel — so "Try again" could
     * never work and the screen kept repainting the state it was already in. This says the true
     * thing and points at the only action that helps.
     */
    session_expired: 'This sign-in took too long. Start again to continue.',
  },
  action: {
    retry: 'Try again',
    other_method: 'Use another method',
    /**
     * LOGTO PATCH(te-canal-revive): written over the veiled code, and the accessible name of the
     * button the whole code has become. Short, because it sits on top of the thing it acts on.
     */
    new_code: 'Get a new code',
    /** LOGTO PATCH(te-canal-revive): reloads, which the server turns into a fresh sign-in. */
    restart: 'Start again',
  },
};

export default Object.freeze(te);
