import LoginDynamic from "./login-dynamic";

export default function Header() {
  return (
    <header className="p-5 flex justify-between items-center">
      <div className="flex flex-row items-center gap-1">
        <svg
          className="h-6"
          viewBox="0 0 32 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M5.12366 4.56488C5.20594 4.16302 5.56357 3.85712 5.98533 3.85712H9.47261C9.93884 3.85712 10.1465 3.64743 10.4236 3.24051L11.9604 0.430052C12.1052 0.165416 12.3884 0 12.6969 0H25.5301C25.8606 0 26.1355 0.247737 26.162 0.567468C26.6782 6.79843 27.3326 11.022 31.4761 14.845C31.9108 15.2461 31.6328 16 31.0329 16H0.655819C0.0550865 16 -0.223428 15.2441 0.211887 14.8424C3.17796 12.1053 4.36631 9.11091 4.99402 5.23535C5.02545 5.04128 5.06395 4.85465 5.10259 4.66731C5.10962 4.63321 5.11666 4.59908 5.12366 4.56488Z"
            fill="black"
          />
        </svg>
        <h1 className="font-normal text-2xl uppercase text-fuchsia-800">
          Studio
        </h1>
      </div>
      {/* <nav></nav> */}
      <LoginDynamic />
    </header>
  );
}