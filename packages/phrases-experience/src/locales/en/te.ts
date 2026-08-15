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
  },
  push: {
    title: 'Approve on your phone',
    description: 'We sent a request to your device. Approve it there to continue.',
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
  },
  action: {
    retry: 'Try again',
    other_method: 'Use another method',
  },
};

export default Object.freeze(te);
