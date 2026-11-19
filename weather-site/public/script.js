// Variable declaration. Fetches elements from the HTML file by id or class
const searchForm = document.getElementById("searchForm");
const userLocation = document.getElementById("userLocation");
const converter = document.getElementById("converter");
const message = document.getElementById("message");
const weatherIcon = document.querySelector(".weatherIcon");
const temperature = document.querySelector(".temperature");
const feelslike = document.querySelector(".feelslike");
const description = document.querySelector(".description");
const date = document.querySelector(".date");
const city = document.querySelector(".city");
const humidityValue = document.getElementById("humidityValue");
const windValue = document.getElementById("windValue");
const cloudsValue = document.getElementById("cloudsValue");
const visibilityValue = document.getElementById("visibilityValue");
const pressureValue = document.getElementById("pressureValue");
const forecastContainer = document.getElementById("forecast");

// Same rule the server should enforce: letters (any language), spaces, . ' -
const CITY_PATTERN = /^[\p{L}\s.'-]+$/u;

// Latest data is kept so the unit toggle can redraw without a new request
let currentData = null;
let forecastData = null;
let useFahrenheit = false;

// ---------- Helpers ----------

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function toTemp(celsius) {
  const value = useFahrenheit ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°${useFahrenheit ? "F" : "C"}`;
}

function toSpeed(metersPerSecond) {
  return useFahrenheit
    ? `${(metersPerSecond * 2.237).toFixed(1)} mph`
    : `${metersPerSecond} m/s`;
}

// Validates the city input and returns the cleaned name, or null if invalid
function validateCity(raw) {
  const cityName = raw.trim();
  if (!cityName) {
    showMessage("Enter a city name.");
    return null;
  }
  if (cityName.length > 60) {
    showMessage("City names can be at most 60 characters.");
    return null;
  }
  if (!CITY_PATTERN.test(cityName)) {
    showMessage("Use letters, spaces, apostrophes, dots or hyphens only.");
    return null;
  }
  return cityName;
}

// ---------- Rendering ----------

function renderCurrent() {
  if (!currentData) return;
  const data = currentData;

  temperature.textContent = toTemp(data.main.temp);
  feelslike.textContent = `Feels like: ${toTemp(data.main.feels_like)}`;
  description.textContent = data.weather[0].description;
  city.textContent = data.name;
  humidityValue.textContent = `${data.main.humidity}%`;
  windValue.textContent = toSpeed(data.wind.speed);
  cloudsValue.textContent = `${data.clouds.all}%`;
  visibilityValue.textContent =
    typeof data.visibility === "number"
      ? `${(data.visibility / 1000).toFixed(1)} km`
      : "N/A";
  pressureValue.textContent = `${data.main.pressure} hPa`;
  date.textContent = new Date().toLocaleString();

  // Current weather icon (built with DOM methods, not innerHTML)
  weatherIcon.replaceChildren();
  const img = document.createElement("img");
  img.src = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
  img.alt = data.weather[0].description;
  img.width = 100;
  img.height = 100;
  weatherIcon.appendChild(img);

  updateSaveButton();
}

function renderForecast() {
  forecastContainer.replaceChildren();
  if (!forecastData) return;

  // Keep one entry per day: the midday (12:00) reading
  const dailyData = {};
  forecastData.list.forEach((entry) => {
    const [day, time] = entry.dt_txt.split(" ");
    const hour = parseInt(time.split(":")[0], 10);
    if (hour === 12 && !dailyData[day]) {
      dailyData[day] = entry;
    }
  });

  Object.keys(dailyData).forEach((dayKey) => {
    const forecast = dailyData[dayKey];
    const dayLabel = new Date(dayKey).toLocaleDateString("en-KE", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const card = document.createElement("div");
    card.classList.add("forecast-card");

    const heading = document.createElement("h4");
    heading.textContent = dayLabel;

    const img = document.createElement("img");
    img.src = `https://openweathermap.org/img/wn/${forecast.weather[0].icon}@2x.png`;
    img.alt = forecast.weather[0].description;

    const temp = document.createElement("p");
    temp.textContent = toTemp(forecast.main.temp);

    const desc = document.createElement("p");
    desc.textContent = forecast.weather[0].description;

    card.append(heading, img, temp, desc);
    forecastContainer.appendChild(card);
  });
}

// ---------- Fetching ----------

// Fetch and display the current weather data
async function findUserLocation() {
  const cityName = validateCity(userLocation.value);
  if (!cityName) return;
  showMessage("");

  try {
    // Calls our own backend, which adds the API key server-side
    const res = await fetch(`/api/weather?q=${encodeURIComponent(cityName)}`);
    if (!res.ok) {
      showMessage(
        res.status === 404
          ? "City not found. Check the spelling and try again."
          : "Could not load weather right now. Try again in a moment."
      );
      return;
    }
    currentData = await res.json();
    renderCurrent();
    getForecast(cityName);
  } catch (error) {
    console.error("Error fetching current weather:", error);
    showMessage("Could not reach the server. Check your connection.");
  }
}

// Fetch and display the 5-day forecast
async function getForecast(cityName) {
  try {
    const res = await fetch(`/api/forecast?q=${encodeURIComponent(cityName)}`);
    if (!res.ok) throw new Error(`Forecast request failed (${res.status})`);
    forecastData = await res.json();
    renderForecast();
  } catch (error) {
    console.error("Error fetching forecast:", error);
    forecastData = null;
    renderForecast();
    showMessage("Current weather loaded, but the forecast is unavailable.");
  }
}

// ---------- Events ----------

// Enter key and search button both submit the form
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  findUserLocation();
});

// Clear the error as soon as the user edits the input
userLocation.addEventListener("input", () => showMessage(""));

// Celsius / Fahrenheit switch redraws from saved data
converter.addEventListener("click", () => {
  useFahrenheit = !useFahrenheit;
  converter.textContent = useFahrenheit ? "Switch to °C" : "Switch to °F";
  renderCurrent();
  renderForecast();
});

// ---------- Accounts and saved cities ----------
const authBar = document.getElementById("authBar");
const saveCity = document.getElementById("saveCity");
const favouritesList = document.getElementById("favourites");
let signedInEmail = null;

function updateSaveButton() {
  saveCity.hidden = !(signedInEmail && currentData);
}

function renderAuthBar() {
  authBar.replaceChildren();
  if (signedInEmail) {
    const who = document.createElement("span");
    who.textContent = signedInEmail;
    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "link-btn";
    logout.textContent = "Log out";
    logout.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      signedInEmail = null;
      renderAuthBar();
      renderFavourites([]);
      updateSaveButton();
    });
    authBar.append(who, logout);
  } else {
    const link = document.createElement("a");
    link.href = "account.html";
    link.textContent = "Log in or register";
    authBar.appendChild(link);
  }
}

function renderFavourites(items) {
  favouritesList.replaceChildren();
  items.forEach((fav) => {
    const li = document.createElement("li");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "fav-city";
    open.textContent = fav.city;
    open.addEventListener("click", () => {
      userLocation.value = fav.city;
      findUserLocation();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "fav-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${fav.city} from saved cities`);
    remove.addEventListener("click", async () => {
      await fetch(`/api/favourites/${fav.id}`, { method: "DELETE" });
      loadFavourites();
    });

    li.append(open, remove);
    favouritesList.appendChild(li);
  });
}

async function loadFavourites() {
  try {
    const res = await fetch("/api/favourites");
    if (res.ok) renderFavourites(await res.json());
  } catch (error) {
    console.error("Error loading saved cities:", error);
  }
}

async function loadSession() {
  try {
    const res = await fetch("/api/me");
    signedInEmail = res.ok ? (await res.json()).email : null;
  } catch (error) {
    signedInEmail = null;
  }
  renderAuthBar();
  updateSaveButton();
  if (signedInEmail) loadFavourites();
}

saveCity.addEventListener("click", async () => {
  if (!currentData) return;
  try {
    const res = await fetch("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: currentData.name }),
    });
    if (res.ok) {
      showMessage("");
      loadFavourites();
    } else {
      const data = await res.json().catch(() => ({}));
      showMessage(data.message || "Could not save this city.");
    }
  } catch (error) {
    showMessage("Could not reach the server. Check your connection.");
  }
});

loadSession();
