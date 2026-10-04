from django.http import HttpResponse
from django.utils.cache import patch_vary_headers

from .platform_runtime import get_runtime_cors_origins


class DynamicCorsMiddleware:
    """Adds CORS support for the validated origins managed by Main Admin.

    The normal django-cors-headers configuration remains the fallback. This
    middleware only augments it with the safe runtime list stored in the DB.
    """

    ALLOW_METHODS = "DELETE, GET, OPTIONS, PATCH, POST, PUT"
    ALLOW_HEADERS = (
        "accept, authorization, content-type, origin, user-agent, "
        "x-csrftoken, x-requested-with"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = str(request.headers.get("Origin", "") or "").strip()
        allowed = bool(origin and origin in get_runtime_cors_origins())

        if allowed and request.method == "OPTIONS":
            response = HttpResponse(status=200)
        else:
            response = self.get_response(request)

        if allowed:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Methods"] = self.ALLOW_METHODS
            response["Access-Control-Allow-Headers"] = self.ALLOW_HEADERS
            response["Access-Control-Max-Age"] = "86400"
            patch_vary_headers(response, ("Origin",))

        return response
