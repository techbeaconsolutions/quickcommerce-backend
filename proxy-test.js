const rp = require("request-promise");

rp({
  url: "http://ipv4.webshare.io/",
  proxy: "http://tqeehzfg-1:rdedpatrpnhn@p.webshare.io:80",
  timeout: 10000
})
  .then((data) => {
    console.log("SUCCESS → Proxy Works");
    console.log("Your proxy IP:", data);
  })
  .catch((err) => {
    console.error("PROXY FAILED →", err.message);
  });
