import useMediaQuery from "./useMediaQuery";
import { MOBILE_MEDIA_QUERY } from "../lib/breakpoints";

export default function useIsMobile() {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
