// Coarse browser and OS family from the User-Agent header. The raw string is never stored.
export function browserFamily(ua) {
  const s = String(ua || "");
  if (!s) return "";
  let b = "Other";
  if (/Edg\//.test(s)) b = "Edge";
  else if (/OPR\//.test(s)) b = "Opera";
  else if (/Firefox\//.test(s)) b = "Firefox";
  else if (/Chrome\//.test(s)) b = "Chrome";
  else if (/Safari\//.test(s)) b = "Safari";
  let os = "Other";
  if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Android/.test(s)) os = "Android";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Mac OS X/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";
  return `${b}/${os}`;
}
