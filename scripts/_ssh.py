"""
Conexión SSH compartida por los scripts de mantenimiento.

Las credenciales NUNCA van en el código (el repo es público). Se leen de
variables de entorno:

  PRINTFARM_SSH_HOST      host o IP del servidor (ej. IP de Tailscale)
  PRINTFARM_SSH_USER      usuario SSH
  PRINTFARM_SSH_PASSWORD  contraseña (opcional si usás clave SSH)
  PRINTFARM_SSH_KEY       ruta a la clave privada (opcional; recomendado)

Si no hay contraseña ni clave, paramiko intenta con el agente SSH y las
claves por defecto de ~/.ssh.
"""

import os
import sys

import paramiko


def connect() -> paramiko.SSHClient:
    host = os.environ.get("PRINTFARM_SSH_HOST")
    user = os.environ.get("PRINTFARM_SSH_USER")
    if not host or not user:
        sys.exit(
            "Faltan PRINTFARM_SSH_HOST y/o PRINTFARM_SSH_USER en el entorno. "
            "Ver scripts/_ssh.py."
        )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Conectando a {host}...")
    client.connect(
        host,
        username=user,
        password=os.environ.get("PRINTFARM_SSH_PASSWORD") or None,
        key_filename=os.environ.get("PRINTFARM_SSH_KEY") or None,
        timeout=10,
    )
    return client
