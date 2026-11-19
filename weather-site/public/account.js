const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const accountMessage = document.getElementById("accountMessage");

function showMessage(text) {
  accountMessage.textContent = text;
  accountMessage.hidden = !text;
}

// Sends JSON to the server and returns { ok, data }
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // response had no JSON body
  }
  return { ok: res.ok, data };
}

// Uses the browser's built-in checks (required, type=email, minlength, maxlength)
function formIsValid(form) {
  if (form.checkValidity()) return true;
  const firstBad = form.querySelector(":invalid");
  showMessage(
    firstBad.validity.tooShort
      ? "Password must be at least 10 characters."
      : "Check the highlighted fields and try again."
  );
  firstBad.focus();
  return false;
}

function serverError(data, fallback) {
  if (Array.isArray(data.errors) && data.errors.length) {
    return data.errors.map((e) => e.message).join(". ") + ".";
  }
  return data.message || fallback;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!formIsValid(loginForm)) return;
  try {
    const { ok, data } = await postJson("/api/login", {
      email: loginForm.email.value,
      password: loginForm.password.value,
    });
    if (ok) {
      window.location.href = "/";
    } else {
      showMessage(serverError(data, "Could not log in."));
    }
  } catch (error) {
    showMessage("Could not reach the server. Check your connection.");
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!formIsValid(registerForm)) return;
  try {
    const email = registerForm.email.value;
    const password = registerForm.password.value;
    const reg = await postJson("/api/register", { email, password });
    if (!reg.ok) {
      showMessage(serverError(reg.data, "Could not create the account."));
      return;
    }
    // Log in straight away after registering
    const login = await postJson("/api/login", { email, password });
    if (login.ok) {
      window.location.href = "/";
    } else {
      showMessage("Account created. Log in with your new details.");
    }
  } catch (error) {
    showMessage("Could not reach the server. Check your connection.");
  }
});
