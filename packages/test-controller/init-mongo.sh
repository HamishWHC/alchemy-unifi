#!/bin/bash
mongosh -- "$MONGO_INITDB_DATABASE" <<JS
db.getSiblingDB("admin").createUser({user: "unifi", pwd: "unifi", roles: [{role: "dbOwner", db: "unifi"}, {role: "dbOwner", db: "unifi_stat"}, {role: "dbOwner", db: "unifi_audit"}]})
JS
