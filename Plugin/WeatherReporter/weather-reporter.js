// Plugin/WeatherReporter/weather-reporter.js
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
// const fetch = require('node-fetch'); // Use require for node-fetch - Removed

// Load plugin-specific config.env first to give it priority
dotenv.config({ path: path.join(__dirname, 'config.env') });

// Load main config.env from project root (it will not override existing vars)
dotenv.config({ path: path.resolve(__dirname, '../../config.env') });

const CACHE_FILE_PATH = path.join(__dirname, 'weather_cache.txt');
const CITY_CACHE_FILE_PATH = path.join(__dirname, 'city_cache.txt');

// --- Start QWeather API Functions ---

// Function to read city cache
async function readCityCache() {
    try {
        const data = await fs.readFile(CITY_CACHE_FILE_PATH, 'utf-8');
        const cache = new Map();
        data.split('\n').forEach(line => {
            const [cityName, cityId] = line.split(':');
            if (cityName && cityId) {
                cache.set(cityName.trim(), cityId.trim());
            }
        });
        console.error(`[WeatherReporter] Successfully read city cache from ${CITY_CACHE_FILE_PATH}`);
        return cache;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[WeatherReporter] Error reading city cache file ${CITY_CACHE_FILE_PATH}:`, error.message);
        }
        return new Map(); // Return empty map if file doesn't exist or error occurs
    }
}

// Function to write city cache
async function writeCityCache(cityName, cityId) {
    try {
        // Append to the file, creating it if it doesn't exist
        await fs.appendFile(CITY_CACHE_FILE_PATH, `${cityName}:${cityId}\n`, 'utf-8');
        console.error(`[WeatherReporter] Successfully wrote city cache for ${cityName}:${cityId} to ${CITY_CACHE_FILE_PATH}`);
    } catch (error) {
        console.error(`[WeatherReporter] Error writing city cache file ${CITY_CACHE_FILE_PATH}:`, error.message);
    }
}

// Function to get City ID from city name
async function getCityId(cityName, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityName || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City name, Weather Key or Weather URL is missing for getCityId.');
        return { success: false, data: null, error: new Error('Missing parameters for getCityId.') };
    }

    // Check cache first
    const cityCache = await readCityCache();
    if (cityCache.has(cityName)) {
        const cachedCityId = cityCache.get(cityName);
        console.error(`[WeatherReporter] Using cached city ID for ${cityName}: ${cachedCityId}`);
        return { success: true, data: cachedCityId, error: null };
    }

    const lookupUrl = `https://${weatherUrl}/geo/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching city ID for: ${cityName}`);
        const response = await fetch(lookupUrl, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather City Lookup API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200' && data.location && data.location.length > 0) {
            const cityId = data.location[0].id;
            console.error(`[WeatherReporter] Successfully found city ID: ${cityId}`);
            // Write to cache
            await writeCityCache(cityName, cityId);
            return { success: true, data: cityId, error: null };
        } else {
             const errorMsg = data.code === '200' ? 'No location found' : `API returned code ${data.code}`;
             throw new Error(`Failed to get city ID for ${cityName}. ${errorMsg}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching city ID: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Current Weather from City ID
async function getCurrentWeather(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getCurrentWeather.');
        return { success: false, data: null, error: new Error('Missing parameters for getCurrentWeather.') };
    }

    const weatherUrlEndpoint = `https://${weatherUrl}/v7/weather/now?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching current weather for city ID: ${cityId}`);
        const response = await fetch(weatherUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather Current Weather API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200' && data.now) {
            console.error(`[WeatherReporter] Successfully fetched current weather for ${cityId}.`);
            return { success: true, data: data.now, error: null };
        } else {
             throw new Error(`Failed to get current weather for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching current weather: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get N-day Forecast from City ID
async function getForecast(cityId, weatherKey, weatherUrl, days) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityId || !weatherKey || !weatherUrl || !days) {
        console.error('[WeatherReporter] City ID, Weather Key, Weather URL, or days is missing for getForecast.');
        return { success: false, data: null, error: new Error('Missing parameters for getForecast.') };
    }

    // Determine the correct API endpoint based on the number of days
    let apiDays;
    if (days <= 3) apiDays = '3d';
    else if (days <= 7) apiDays = '7d';
    else if (days <= 10) apiDays = '10d';
    else if (days <= 15) apiDays = '15d';
    else apiDays = '30d'; // Default to 30d for anything larger than 15

    const forecastUrlEndpoint = `https://${weatherUrl}/v7/weather/${apiDays}?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching ${days}-day forecast for city ID: ${cityId} using ${apiDays} endpoint.`);
        const response = await fetch(forecastUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather ${apiDays} Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200' && data.daily) {
            // Slice the array to return only the number of days requested
            const slicedForecast = data.daily.slice(0, days);
            console.error(`[WeatherReporter] Successfully fetched and sliced ${days}-day forecast for ${cityId}.`);
            return { success: true, data: slicedForecast, error: null };
        } else {
            throw new Error(`Failed to get forecast for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching ${days}-day forecast: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get 24-hour Forecast from City ID
async function get24HourForecast(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
     if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for get24HourForecast.');
        return { success: false, data: null, error: new Error('Missing parameters for get24HourForecast.') };
    }

    const forecastUrlEndpoint = `https://${weatherUrl}/v7/weather/24h?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching 24-hour forecast for city ID: ${cityId}`);
        const response = await fetch(forecastUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather 24-hour Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200' && data.hourly) {
            console.error(`[WeatherReporter] Successfully fetched 24-hour forecast for ${cityId}.`);
            return { success: true, data: data.hourly, error: null };
        } else {
             throw new Error(`Failed to get 24-hour forecast for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching 24-hour forecast: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Weather Warning from City ID
async function getWeatherWarning(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
     if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getWeatherWarning.');
        return { success: false, data: null, error: new Error('Missing parameters for getWeatherWarning.') };
    }

    const warningUrlEndpoint = `https://${weatherUrl}/v7/warning/now?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching weather warning for city ID: ${cityId}`);
        const response = await fetch(warningUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather Weather Warning API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200') {
            console.error(`[WeatherReporter] Successfully fetched weather warning for ${cityId}.`);
            // The 'warning' field might be empty if no warnings exist
            return { success: true, data: data.warning || [], error: null };
        } else {
             throw new Error(`Failed to get weather warning for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching weather warning: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Helper to format weather data into a readable string
function formatWeatherInfo(hourlyForecast, weatherWarning, forecast, days, hourlyInterval, hourlyCount) {
    if (!hourlyForecast && (!weatherWarning || weatherWarning.length === 0) && (!forecast || forecast.length === 0)) {
        return "[天气信息获取失败]";
    }

    let result = "";

    // Add Weather Warning section
    result += "【天气预警】\n";
    if (weatherWarning && weatherWarning.length > 0) {
        weatherWarning.forEach(warning => {
            result += `\n标题: ${warning.title}\n`;
            result += `发布时间: ${new Date(warning.pubTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
            result += `级别: ${warning.severityColor || '未知'}\n`;
            result += `类型: ${warning.typeName}\n`;
            result += `内容: ${warning.text}\n`;
        });
    } else {
        result += "当前无天气预警信息。\n";
    }

    // Add 24-hour Forecast section
    result += "\n【未来24小时天气预报】\n";
    if (hourlyForecast && hourlyForecast.length > 0) {
        let displayedCount = 0;
        for (let i = 0; i < hourlyForecast.length && displayedCount < hourlyCount; i += hourlyInterval) {
            const hour = hourlyForecast[i];
            const time = new Date(hour.fxTime).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
            result += `\n时间: ${time}\n`;
            result += `天气: ${hour.text}\n`;
            result += `温度: ${hour.temp}℃\n`;
            result += `风向: ${hour.windDir}\n`;
            result += `风力: ${hour.windScale}级\n`;
            result += `湿度: ${hour.humidity}%\n`;
            result += `降水概率: ${hour.pop}%\n`;
            result += `降水量: ${hour.precip}毫米\n`;
            displayedCount++;
        }
    } else {
        result += "未来24小时天气预报获取失败。\n";
    }

    // Keep N-day Forecast section
    if (forecast && forecast.length > 0) {
        result += `\n【未来${days}日天气预报】\n`;
        forecast.forEach(day => {
            result += `\n日期: ${day.fxDate}\n`;
            result += `白天: ${day.textDay} (图标: ${day.iconDay}), 最高温: ${day.tempMax}℃, 风向: ${day.windDirDay}, 风力: ${day.windScaleDay}级\n`;
            result += `夜间: ${day.textNight} (图标: ${day.iconNight}), 最低温: ${day.tempMin}℃, 风向: ${day.windDirNight}, 风力: ${day.windScaleNight}级\n`;
            result += `湿度: ${day.humidity}%\n`;
            result += `降水: ${day.precip}毫米\n`;
            result += `紫外线指数: ${day.uvIndex}\n`;
        });
    } else {
         result += `\n未来${days}日天气预报获取失败。\n`;
    }


    return result.trim();
}

// --- End QWeather API Functions ---


async function getCachedWeather() {
    try {
        const cachedData = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        // Basic validation: check if it's not an error message itself
        if (cachedData && !cachedData.startsWith("[Error") && !cachedData.startsWith("[天气API请求失败")) {
            return cachedData.trim();
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[WeatherReporter] Error reading cache file ${CACHE_FILE_PATH}:`, error.message);
        }
    }
    return null;
}

async function fetchAndCacheWeather() {
    let lastError = null;

    const varCity = process.env.VarCity;
    const weatherKey = process.env.WeatherKey;
    const weatherUrl = process.env.WeatherUrl;
    let forecastDays = parseInt(process.env.forecastDays, 10);
    let hourlyInterval = parseInt(process.env.hourlyForecastInterval, 10);
    let hourlyCount = parseInt(process.env.hourlyForecastCount, 10);

    // Validate forecastDays
    if (isNaN(forecastDays) || forecastDays < 1 || forecastDays > 30) {
        console.warn(`[WeatherReporter] Invalid or missing 'forecastDays' in config. Defaulting to 7. Value was: ${process.env.forecastDays}`);
        forecastDays = 7;
    }
    
    // Validate hourlyInterval
    if (isNaN(hourlyInterval) || hourlyInterval < 1) {
        console.warn(`[WeatherReporter] Invalid or missing 'hourlyForecastInterval' in config. Defaulting to 3. Value was: ${process.env.hourlyForecastInterval}`);
        hourlyInterval = 3;
    }

    // Validate hourlyCount
    if (isNaN(hourlyCount) || hourlyCount < 1) {
        console.warn(`[WeatherReporter] Invalid or missing 'hourlyForecastCount' in config. Defaulting to 4. Value was: ${process.env.hourlyForecastCount}`);
        hourlyCount = 4;
    }


    if (!varCity || !weatherKey || !weatherUrl) {
        lastError = new Error('天气插件错误：获取天气所需的配置不完整 (VarCity, WeatherKey, WeatherUrl)。');
        console.error(`[WeatherReporter] ${lastError.message}`);
        return { success: false, data: null, error: lastError };
    }

    let cityId = null;
    let hourlyForecast = null; // New variable for 24-hour forecast
    let weatherWarning = null; // New variable for weather warning
    let forecast = null; // Keep N-day forecast

    // 1. Get City ID
    const cityResult = await getCityId(varCity, weatherKey, weatherUrl);
    if (cityResult.success) {
        cityId = cityResult.data;
    } else {
        lastError = cityResult.error;
        console.error(`[WeatherReporter] Failed to get city ID: ${lastError.message}`);
        // Continue attempting to get weather/forecast even if city ID failed,
        // though it's unlikely to succeed without it. Log the error and proceed.
    }

    // 2. Get 24-hour Forecast (if cityId is available)
    if (cityId) {
        const hourlyResult = await get24HourForecast(cityId, weatherKey, weatherUrl);
        if (hourlyResult.success) {
            hourlyForecast = hourlyResult.data;
        } else {
            lastError = hourlyResult.error;
            console.error(`[WeatherReporter] Failed to get 24-hour forecast: ${lastError.message}`);
        }
    }

    // 3. Get Weather Warning (if cityId is available)
     if (cityId) {
        const warningResult = await getWeatherWarning(cityId, weatherKey, weatherUrl);
        if (warningResult.success) {
            weatherWarning = warningResult.data;
        } else {
            lastError = warningResult.error;
            console.error(`[WeatherReporter] Failed to get weather warning: ${lastError.message}`);
        }
    }


    // 4. Get N-day Forecast (if cityId is available)
    if (cityId) {
        const forecastResult = await getForecast(cityId, weatherKey, weatherUrl, forecastDays);
        if (forecastResult.success) {
            forecast = forecastResult.data;
        } else {
            lastError = forecastResult.error;
            console.error(`[WeatherReporter] Failed to get ${forecastDays}-day forecast: ${lastError.message}`);
        }
    }

    // 5. Format and Cache the results
    // Update condition to check for any data
    if (hourlyForecast || weatherWarning || (forecast && forecast.length > 0)) {
        // Update function call
        const formattedWeather = formatWeatherInfo(hourlyForecast, weatherWarning, forecast, forecastDays, hourlyInterval, hourlyCount);
        try {
            await fs.writeFile(CACHE_FILE_PATH, formattedWeather, 'utf-8');
            console.error(`[WeatherReporter] Successfully fetched, formatted, and cached new weather info.`);
            return { success: true, data: formattedWeather, error: null };
        } catch (writeError) {
            lastError = writeError;
            console.error(`[WeatherReporter] Error writing to cache file: ${writeError.message}`);
            return { success: false, data: formattedWeather, error: lastError }; // Return data even if cache write fails
        }
    } else {
        // If all fetches failed
        lastError = lastError || new Error(`未能获取天气信息 (24小时预报, 预警, ${forecastDays}日预报)。`);
        console.error(`[WeatherReporter] ${lastError.message}`);
        return { success: false, data: null, error: lastError };
    }
}

async function main() {
    const apiResult = await fetchAndCacheWeather();

    if (apiResult.success && apiResult.data) {
        process.stdout.write(apiResult.data);
        process.exit(0);
    } else {
        // API failed, try to use cache
        const cachedData = await getCachedWeather();
        if (cachedData) {
            console.warn("[WeatherReporter] API fetch failed, using stale cache.");
            process.stdout.write(cachedData);
            process.exit(0); // Exit 0 because we are providing data, albeit stale.
        } else {
            // API failed AND no cache available
            const errorMessage = `[天气API请求失败且无可用缓存: ${apiResult.error ? apiResult.error.message.substring(0,100) : '未知错误'}]`;
            console.error(`[WeatherReporter] ${errorMessage}`);
            process.stdout.write(errorMessage); // Output error to stdout so Plugin.js can use it as placeholder
            process.exit(1); // Exit 1 to indicate to Plugin.js that the update truly failed to produce a usable value.
        }
    }
}

if (require.main === module) {
    main();
}
