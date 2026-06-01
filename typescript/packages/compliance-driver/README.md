# @postel/compliance-driver

HTTP control-plane shim the `@postel/compliance` suite drives in `--sender-control` mode. The driver wraps a real `Postel({ outbound: { storage: InMemoryStorage() } })` instance and exposes six control-plane routes the compliance runner uses to register endpoints, send events, start workers, and advance the clock.

This package is part of the cross-port CONTRACT surface for sender-side compliance (see the compliance capability spec).
