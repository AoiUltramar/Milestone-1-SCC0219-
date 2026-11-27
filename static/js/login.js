/* ==========================================================================
   login.js — the sign-in screen (/login): wires its two forms to Auth
   --------------------------------------------------------------------------
   The screen has two forms: sign in (#signin-form) and create an account
   (#register-form). This script:
     1. works out where to go afterwards (the ?next= address);
     2. skips the forms if the person is already signed in;
     3. handles both submissions.
   The server does the real work (checks the password, starts the session,
   moves the visitor's cart into the account); this file only shows the result.
   ========================================================================== */

Views.login = async ({ signal, query }) => {
    const signInForm    = document.getElementById("signin-form");
    const registerForm  = document.getElementById("register-form");
    const signInError   = document.getElementById("signin-error");
    const registerError = document.getElementById("register-error");

    /* ---------- 1) Where to go afterwards ---------- */
    // /login?next=/cart sends the person back to the cart once signed in.
    // Router.isInternal accepts only addresses of THIS application (/cart,
    // /vms?x=1), so nobody can craft a link that bounces users to another site
    // after they sign in ("open redirect").
    // The address is followed only if the person's role may open it; otherwise
    // two screens could keep sending the user to each other.
    const requested = query.get("next");
    const validNext = Router.isInternal(requested) ? requested : null;
    const nextPage = user => (validNext && Auth.canOpen(user, validNext) ? validNext : Auth.homeFor(user));

    /* ---------- 3) The forms (attached first, so a fast click is never lost) ---------- */
    signInForm.addEventListener("submit", async (event) => {
        event.preventDefault();             // don't let the browser submit the form and reload the page
        signInError.hidden = true;
        const data = new FormData(signInForm);
        try {
            const user = await Auth.login(data.get("login"), data.get("password"));
            // The server already moved anything added as a visitor into this account.
            await Router.go(nextPage(user));
        } catch (err) {
            UI.showError(signInError, err.message);
            signInForm.elements.password.value = "";       // keep the email, clear only the password
        }
    }, { signal });

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        registerError.hidden = true;
        const data = Object.fromEntries(new FormData(registerForm));
        try {
            // The form's "address" field is only the street; the account wants {street, city, cep}.
            const user = await Auth.register({ ...data, address: { street: data.address, city: data.city, cep: data.cep } });
            // Came from another screen? Go back there. A brand-new account is offered the free trial.
            await Router.go(validNext ? nextPage(user) : "/trial");
        } catch (err) {
            UI.showError(registerError, err.message);
        }
    }, { signal });

    /* ---------- 2) Already signed in? ---------- */
    const user = await Auth.currentUser();
    if (!user || signal.aborted) return;

    if (validNext && !Auth.canOpen(user, validNext)) {
        // Signed in, but the screen they wanted needs the other role (a customer
        // opening the admin area, for example). Explain, and let them sign in
        // with another account.
        const needed = Auth.roleFor(validNext) === "admin" ? "an administrator" : "a customer";
        const current = user.role === "admin" ? "an administrator" : "a customer";
        // innerHTML because the message holds a link; the name is typed by a person,
        // so it goes through UI.esc first (stops HTML injection).
        signInError.innerHTML =
            `That page needs ${needed} account, and you're signed in as ${current} (${UI.esc(user.name)}). ` +
            `Sign in below with ${needed} account, or <a href="${Auth.homeFor(user)}">go back to your own page</a>.`;
        signInError.hidden = false;
        return;
    }
    // Normal case: skip the form. `replace` keeps /login out of the history,
    // so the Back button doesn't land on a screen that would redirect again.
    Router.go(nextPage(user), { replace: true });
};
