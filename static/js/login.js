/* ==========================================================================
   login.js — wires the two forms on login.html to Auth (auth.js)
   ========================================================================== */

(() => {
    const signInForm    = document.getElementById("signin-form");
    const registerForm  = document.getElementById("register-form");
    const signInError   = document.getElementById("signin-error");
    const registerError = document.getElementById("register-error");

    // login.html?next=cart.html sends the user back there after signing in.
    // Only plain file names are accepted, so nobody can craft a link that
    // bounces users to another website.
    // The page is only followed if this user's role may open it; otherwise
    // the two pages would keep sending the user to each other forever.
    const requested = new URLSearchParams(location.search).get("next");
    const validNext = requested && /^[\w-]+\.html(\?[\w=&-]*)?$/.test(requested) ? requested : null;
    function nextPage(user) {
        return validNext && Auth.canOpen(user, validNext) ? validNext : Auth.homeFor(user);
    }

    // Already signed in? Skip the form, unless they came here because their
    // account can't open the page they wanted: then explain, and let them
    // sign in with another account.
    Auth.currentUser().then(user => {
        if (!user) return;
        if (validNext && !Auth.canOpen(user, validNext)) {
            const needed = Auth.roleFor(validNext) === "admin" ? "an administrator" : "a customer";
            const current = user.role === "admin" ? "an administrator" : "a customer";
            signInError.innerHTML =
                `That page needs ${needed} account, and you're signed in as ${current} (${UI.esc(user.name)}). ` +
                `Sign in below with ${needed} account, or <a href="${Auth.homeFor(user)}">go back to your own page</a>.`;
            signInError.hidden = false;
            return;
        }
        location.replace(nextPage(user));
    });

    signInForm.addEventListener("submit", async (event) => {
        event.preventDefault();        // don't let the browser navigate to the form's action
        signInError.hidden = true;
        const data = new FormData(signInForm);
        try {
            const user = await Auth.login(data.get("login"), data.get("password"));
            if (user.role === "customer") await Cart.mergeGuestInto(user.id);   // keep what they added as a visitor
            location.href = nextPage(user);
        } catch (err) {
            UI.showError(signInError, err.message);
            signInForm.elements.password.value = "";
        }
    });

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        registerError.hidden = true;
        const data = Object.fromEntries(new FormData(registerForm));
        try {
            const user = await Auth.register({ ...data, address: { street: data.address, city: data.city, cep: data.cep } });
            await Cart.mergeGuestInto(user.id);
            const next = new URLSearchParams(location.search).get("next");
            location.href = next ? nextPage(user) : "trial.html";   // new accounts get the trial offer
        } catch (err) {
            UI.showError(registerError, err.message);
        }
    });
})();
