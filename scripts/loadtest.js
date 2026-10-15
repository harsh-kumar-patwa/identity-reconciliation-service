// k6 run scripts/loadtest.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  insecureSkipTLSVerify: true,
  // Same idea as curl --resolve: no /etc/hosts entry needed.
  hosts: { "identity.local": "127.0.0.1" },
  stages: [
    { duration: "1m", target: 20 },
    { duration: "3m", target: 50 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<300"],
  },
};

export default function () {
  const id = Math.floor(Math.random() * 5000);
  const res = http.post(
    "https://identity.local/identify",
    JSON.stringify({ email: `user${id}@example.com`, phoneNumber: `${id % 500}` }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(res, { "status is 200": (r) => r.status === 200 });
}
