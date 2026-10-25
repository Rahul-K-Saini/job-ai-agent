const form = document.querySelector("#login-form");
const error = document.querySelector("#login-error");
const submit = form.querySelector("button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.classList.add("hidden");
  submit.disabled = true;
  submit.textContent = "Signing in…";
  const data = new FormData(form);
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in failed.");
    window.location.assign("/");
  } catch (cause) {
    error.textContent = cause.message;
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.innerHTML = "Sign in <span>→</span>";
  }
});
