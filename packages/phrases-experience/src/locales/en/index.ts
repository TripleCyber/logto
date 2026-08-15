import account_center from './account-center.js';
import action from './action.js';
import description from './description.js';
import development_tenant from './development-tenant.js';
import error from './error/index.js';
import input from './input.js';
import list from './list.js';
import mfa from './mfa.js';
import passkey_sign_in from './passkey-sign-in.js';
import profile from './profile.js';
import secondary from './secondary.js';
// LOGTO PATCH(te-factor-choice): copy for the TripleEnable factors. It is a new group, so no
// upstream key changes meaning and a rebase can only ever conflict on these two lines.
import te from './te.js';
import user_scopes from './user-scopes.js';

const en = {
  translation: {
    input,
    secondary,
    action,
    description,
    error,
    list,
    mfa,
    development_tenant,
    user_scopes,
    profile,
    account_center,
    passkey_sign_in,
    te, // LOGTO PATCH(te-factor-choice)
  },
};

export default Object.freeze(en);
